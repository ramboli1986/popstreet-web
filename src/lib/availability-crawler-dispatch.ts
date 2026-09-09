import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CrawlerDispatch = {
  acquired?: boolean;
  dispatch_id: string;
  run_id: string;
  mode: string;
  job_name: string;
  state: string;
  operation_name: string | null;
  execution_name: string | null;
};

export type CrawlerExecution = { operation: string | null; execution: string | null; terminal?: boolean };

export class CrawlerDispatchConflict extends Error {}
export class CrawlerLaunchRejected extends Error {
  httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

export async function dispatchAvailabilityCrawler({
  client, runId, mode, jobName, launch, inspect,
}: {
  client: SupabaseClient;
  runId: string;
  mode: string;
  jobName: string;
  launch: (dispatchId: string) => Promise<CrawlerExecution>;
  inspect: (dispatch: CrawlerDispatch) => Promise<CrawlerExecution | null>;
}) {
  const reserve = async () => {
    const { data, error } = await client.rpc("availability_crawler_reserve_dispatch", {
      p_run_id: runId, p_dispatch_id: randomUUID(), p_mode: mode, p_job_name: jobName,
    });
    if (error) throw new CrawlerDispatchConflict(error.message);
    if (!data?.dispatch_id) throw new Error("Dispatch reservation was not confirmed.");
    return data as CrawlerDispatch;
  };
  const record = async (dispatch: CrawlerDispatch, state: string, identity?: CrawlerExecution) => {
    const { data, error } = await client.rpc("availability_crawler_record_dispatch", {
      p_run_id: runId, p_dispatch_id: dispatch.dispatch_id, p_state: state,
      p_operation_name: identity?.operation ?? null, p_execution_name: identity?.execution ?? null,
    });
    if (error) throw new Error(error.message);
    return data as CrawlerDispatch;
  };
  const reply = (dispatch: CrawlerDispatch, reused: boolean, pending = dispatch.state !== "launched") => ({
    dispatchId: dispatch.dispatch_id, execution: dispatch.execution_name, operation: dispatch.operation_name,
    mode: dispatch.mode ?? mode, runId, started: !pending, pending, reused,
  });

  let dispatch = await reserve();
  if (!dispatch.acquired) {
    // Inspection failure is actionable, but never authorizes another worker.
    const identity = await inspect(dispatch).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : "Inspection failed.";
      throw new Error(`Could not reconcile existing Cloud execution: ${detail} Reservation retained; fix access or connectivity and retry this run.`);
    });
    if (identity?.execution) {
      dispatch = await record(dispatch, "launched", identity);
      if (identity.terminal) {
        const { error } = await client.rpc("availability_crawler_finish_dispatch", {
          p_run_id: runId, p_dispatch_id: dispatch.dispatch_id, p_execution_name: identity.execution,
        });
        if (error) throw new CrawlerDispatchConflict(error.message);
        dispatch = await reserve();
      } else {
        return reply(dispatch, true);
      }
    }
    if (!dispatch.acquired) return reply(dispatch, true);
  }

  // Recheck active run/owner immediately before the external side effect.
  dispatch = await record(dispatch, "launching");
  try {
    const identity = await launch(dispatch.dispatch_id);
    if (!identity.operation && !identity.execution) throw new Error("Cloud launch identity is not yet available.");
    dispatch = await record(dispatch, "launched", identity);
    return reply(dispatch, false);
  } catch (error) {
    if (error instanceof CrawlerLaunchRejected) {
      const { error: rejectionError } = await client.rpc("availability_crawler_reject_dispatch", {
        p_run_id: runId, p_dispatch_id: dispatch.dispatch_id, p_http_status: error.httpStatus,
      });
      if (rejectionError) {
        throw new Error(`${error.message} Reservation release was not confirmed; refresh before retrying.`);
      }
      throw error;
    }
    // This covers accepted-then-disconnected AND accepted-then-DB-write-failed.
    // Keep ownership even if the uncertainty acknowledgment also fails.
    await record(dispatch, "uncertain").catch(() => undefined);
    return reply(dispatch, false, true);
  }
}

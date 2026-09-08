import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

const script = resolve("../PopStreet/scripts/deploy_availability_crawler_cloud_run.sh");
const permissions = ["run.jobs.run", "run.jobs.runWithOverrides", "run.executions.get", "run.executions.list"];

test("crawler deployment script has valid shell syntax", () => {
  execFileSync("bash", ["-n", script]);
});

for (const exists of [false, true]) {
  test(`deployment ${exists ? "updates" : "creates"} least-privilege dispatch role and binds only the job`, () => {
    // Shadow every gcloud invocation, including command substitutions. No cloud
    // binary is executed, no IAM/build/scheduler action can reach a service.
    const result = spawnSync("bash", ["-c", `
      gcloud() {
        printf 'GCLOUD' >&2
        printf '|%s' "$@" >&2
        printf '\\n' >&2
        if [[ "$*" == "iam roles describe "* ]]; then
          [[ "$MOCK_ROLE_EXISTS" == "true" ]]
          return
        fi
        if [[ "$*" == "projects describe "* ]]; then printf '123456\\n'; fi
        if [[ "$*" == "scheduler jobs describe "* ]]; then return 1; fi
        return 0
      }
      source "$1"
    `, "offline-deploy-test", script], {
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME,
        GCP_PROJECT_ID: "test-project", SUPABASE_URL: "https://example.invalid",
        SUPABASE_SERVICE_ROLE_SECRET: "offline-secret", MOCK_ROLE_EXISTS: String(exists),
        ENABLE_CRAWLER_SCHEDULER: "false",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Scheduler not created/);
    const commands = result.stderr.split("\n").filter((line) => line.startsWith("GCLOUD|")).map((line) => line.split("|").slice(1));
    const role = commands.find((args) => args[0] === "iam" && args[1] === "roles" && args[2] === (exists ? "update" : "create"));
    assert.ok(role, "Deployment must provision its custom dispatcher role");
    assert.equal(role[3], "availabilityCrawlerDispatcher");
    const permissionValue = role[role.indexOf("--permissions") + 1];
    assert.deepEqual(permissionValue.split(",").sort(), [...permissions].sort());
    const bindings = commands.filter((args) => args.includes("add-iam-policy-binding") && args.includes("serviceAccount:availability-crawl-dispatcher@test-project.iam.gserviceaccount.com"));
    assert.equal(bindings.length, 1);
    assert.deepEqual(bindings[0].slice(0, 4), ["run", "jobs", "add-iam-policy-binding", "availability-crawler"]);
    assert.equal(bindings[0][bindings[0].indexOf("--role") + 1], "projects/test-project/roles/availabilityCrawlerDispatcher");
    assert.ok(!commands.some((args) => args[0] === "projects" && args.includes("add-iam-policy-binding")), "No project-wide role grant");
    assert.ok(!commands.some((args) => args.includes("roles/run.admin") || args.includes("roles/run.developer") || args.includes("roles/run.viewer")));
    assert.ok(!commands.some((args) => args[0] === "scheduler" && ["create", "update"].includes(args[2])), "Do not enable automation");
  });
}

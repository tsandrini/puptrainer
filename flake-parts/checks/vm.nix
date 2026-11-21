# --- flake-parts/checks/vm.nix
# The NixOS module on one machine: the API open to the network behind a
# token, the worker beside it. A synthetic take is uploaded, analysed and
# survives a restart; requests without the token are refused.
{ self }:
{ pkgs, ... }:
let
  token = "vm-test-token-0123456789";
in
{
  name = "puptrainer-vm";

  nodes.machine = {
    imports = [ self.nixosModules.default ];

    services.puptrainer = {
      enable = true;
      bind = "0.0.0.0:8437";
      tokenFile = pkgs.writeText "puptrainer-token" token;
      openFirewall = true;
    };

    environment.systemPackages = [
      pkgs.curl
      pkgs.jq
      pkgs.sox
    ];
  };

  testScript = ''
    import json

    api = "http://127.0.0.1:8437/api/v1"
    auth = "-H 'Authorization: Bearer ${token}'"

    machine.wait_for_unit("puptrainer-api.service")
    machine.wait_for_unit("puptrainer-worker.service")
    machine.wait_for_open_port(8437)

    with subtest("the API is up and serves the web app"):
        health = json.loads(machine.succeed(f"curl -sf {api}/health"))
        assert health["status"] == "ok", health
        machine.succeed("curl -sf http://127.0.0.1:8437/ | grep -q puptrainer")
        machine.succeed("curl -sf http://127.0.0.1:8437/takes/anything | grep -q puptrainer")

    with subtest("nothing is served without the token"):
        machine.succeed(f"test $(curl -s -o /dev/null -w '%{{http_code}}' {api}/takes) = 401")
        machine.succeed(
            f"test $(curl -s -o /dev/null -w '%{{http_code}}' -H 'Authorization: Bearer nope' {api}/takes) = 401"
        )
        session = json.loads(machine.succeed(f"curl -sf {api}/session"))
        assert session == {"login_required": True, "signed_in": False}, session

    with subtest("signing in sets a cookie that opens the API"):
        machine.succeed(
            f"curl -sf -c /tmp/jar -H 'Content-Type: application/json' -d '{{\"token\": \"${token}\"}}' {api}/login"
        )
        machine.succeed(f"curl -sf -b /tmp/jar {api}/takes")

    with subtest("a take is stored, analysed by the worker and kept"):
        machine.succeed("sox -n -r 48000 -c 1 -b 16 /tmp/tone.wav synth 3 sawtooth 170 gain -12")
        device = json.loads(
            machine.succeed(
                f"curl -sf {auth} -H 'Content-Type: application/json' -d '{{\"name\": \"vm microphone\"}}' {api}/devices"
            )
        )
        meta = json.dumps({"device_id": device["id"], "item": "free", "intent": "habitual"})
        take = json.loads(
            machine.succeed(f"curl -sf {auth} -F file=@/tmp/tone.wav -F 'meta={meta}' {api}/takes")
        )
        machine.wait_until_succeeds(
            f"curl -sf {auth} {api}/takes/{take['id']} | jq -e '.analysis.status == \"done\"'",
            timeout=120,
        )
        done = json.loads(machine.succeed(f"curl -sf {auth} {api}/takes/{take['id']}"))
        pitch = done["metrics"]["pitch_median_hz"]
        assert 168 < pitch < 172, pitch
        assert {"pitch_hz", "level_db", "h1h2_db"} <= set(done["series"]), done["series"]
        machine.succeed(f"curl -sf {auth} {api}/takes/{take['id']}/audio -o /tmp/back.flac")
        machine.succeed("test $(soxi -D /tmp/back.flac | cut -d. -f1) = 3")

    with subtest("the data is private to the service and survives a restart"):
        machine.succeed("test $(stat -c %a /var/lib/puptrainer) = 700")
        machine.succeed("test $(stat -c %U /var/lib/puptrainer) = puptrainer")
        machine.succeed("ls /var/lib/puptrainer/audio/*/*.flac")
        machine.succeed("systemctl restart puptrainer-api.service")
        machine.wait_for_open_port(8437)
        takes = json.loads(machine.succeed(f"curl -sf {auth} {api}/takes"))
        assert [t["id"] for t in takes] == [take["id"]], takes

    with subtest("the token is not in the units' environment"):
        machine.fail("systemctl show puptrainer-api.service -p Environment | grep -q '${token}'")
  '';
}

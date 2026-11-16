# The end-to-end check: the built API serving the built web app on an empty
# data directory, driven by a headless Chromium whose microphone is a
# synthetic tone (`web/scripts/e2e.mjs`). The script starts the built worker
# itself, after it has seen the app without one.
{
  lib,
  flake-root,
  runCommand,
  puptrainer,
  nodejs,
  playwright-driver,
  curl,
  makeFontsConf,
  dejavu_fonts,
}:
runCommand "puptrainer-e2e"
  {
    nativeBuildInputs = [
      puptrainer
      nodejs
      curl
    ];
    PLAYWRIGHT_CORE = playwright-driver;
    PLAYWRIGHT_BROWSERS_PATH = playwright-driver.browsers;
    FONTCONFIG_FILE = makeFontsConf { fontDirectories = [ dejavu_fonts ]; };
    script = flake-root + "/web/scripts/e2e.mjs";
    meta.platforms = lib.platforms.linux;
  }
  ''
    export HOME=$TMPDIR
    export PUPTRAINER_DATA_DIR=$TMPDIR/data PUPTRAINER_BIND=127.0.0.1:8437

    puptrainer-api > api.log 2>&1 &
    api=$!
    trap 'kill $api 2>/dev/null || true' EXIT
    for _ in $(seq 1 60); do
      curl --silent --fail http://127.0.0.1:8437/api/v1/health > /dev/null && break
      sleep 0.5
    done

    if ! node $script --base http://127.0.0.1:8437 --worker puptrainer-worker; then
      echo "--- api.log" >&2
      cat api.log >&2
      exit 1
    fi
    touch $out
  ''

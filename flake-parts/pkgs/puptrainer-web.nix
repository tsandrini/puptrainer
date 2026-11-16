# The web app: the SvelteKit app built into static files the API serves
# (`PUPTRAINER_WEB_DIR`). `npmDepsHash` follows `web/package-lock.json`: after
# a lock change, `prefetch-npm-deps web/package-lock.json` prints the new one.
# `passthru.lint` runs `npm run check`, `npm run lint` and `npm test` in the
# sandbox (a flake check), since the pre-commit hooks need a local node_modules.
{
  lib,
  flake-root,
  buildNpmPackage,
  nodejs,
}:
let
  packageJson = lib.importJSON (flake-root + "/web/package.json");
  web = flake-root + "/web";
  src = lib.fileset.toSource {
    root = flake-root;
    fileset = lib.fileset.difference web (
      lib.fileset.unions [
        (lib.fileset.maybeMissing (web + "/node_modules"))
        (lib.fileset.maybeMissing (web + "/build"))
        (lib.fileset.maybeMissing (web + "/.svelte-kit"))
      ]
    );
  };
  common = {
    inherit (packageJson) version;
    inherit src nodejs;
    sourceRoot = "${src.name}/web";
    npmDepsHash = "sha256-RxXdwo/m4GFddysttonVwTpILZUvghBLsZltTz0KQr8=";
    meta = {
      homepage = "https://github.com/tsandrini/puptrainer";
      license = lib.licenses.eupl12;
      platforms = lib.platforms.linux;
    };
  };
in
buildNpmPackage (
  common
  // {
    pname = "puptrainer-web";

    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -r build/. $out/
      runHook postInstall
    '';

    passthru.lint = buildNpmPackage (
      common
      // {
        pname = "puptrainer-web-lint";
        dontNpmBuild = true;
        doCheck = true;
        checkPhase = ''
          runHook preCheck
          npm run check
          npm run lint
          npm test
          runHook postCheck
        '';
        installPhase = "touch $out";
      }
    );

    meta = common.meta // {
      description = "The puptrainer web app, built";
    };
  }
)

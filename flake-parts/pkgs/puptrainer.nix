# The backend: the API (`puptrainer-api`) and the analysis worker
# (`puptrainer-worker`). The repository's `content/` and, when given, the built
# web app are baked in as defaults of `PUPTRAINER_CONTENT_DIR` and
# `PUPTRAINER_WEB_DIR`. The test suite runs in the build; `passthru.lint` runs
# ruff and pyright (a flake check).
{
  lib,
  flake-root,
  python3,
  ruff,
  pyright,
  runCommand,
  puptrainer-web ? null,
}:
let
  inherit (lib.importTOML (flake-root + "/backend/pyproject.toml")) project;
  deps = import ./python-deps.nix python3.pkgs;
  backend = flake-root + "/backend";
  src = lib.fileset.toSource {
    root = backend;
    fileset = lib.fileset.difference (lib.fileset.unions [
      (backend + "/pyproject.toml")
      (backend + "/src")
      (backend + "/tests")
    ]) (lib.fileset.fileFilter (file: file.hasExt "pyc") backend);
  };
  content = lib.fileset.toSource {
    root = flake-root + "/content";
    fileset = flake-root + "/content";
  };
in
python3.pkgs.buildPythonApplication {
  pname = "puptrainer";
  inherit (project) version;
  pyproject = true;
  inherit src;

  build-system = [ python3.pkgs.hatchling ];
  dependencies = deps.core ++ deps.api ++ deps.analysis;

  nativeCheckInputs = deps.dev ++ [ python3.pkgs.pytestCheckHook ];
  preCheck = ''
    export PUPTRAINER_CONTENT_DIR=${content}
    export PUPTRAINER_TS_TYPES=${flake-root + "/web/src/lib/api/types.ts"}
  '';

  makeWrapperArgs = [
    "--set-default"
    "PUPTRAINER_CONTENT_DIR"
    "${content}"
  ]
  ++ lib.optionals (puptrainer-web != null) [
    "--set-default"
    "PUPTRAINER_WEB_DIR"
    "${puptrainer-web}"
  ];

  passthru.lint =
    runCommand "puptrainer-lint"
      {
        nativeBuildInputs = [
          ruff
          pyright
          (python3.withPackages (_: deps.core ++ deps.api ++ deps.analysis ++ deps.dev))
        ];
      }
      ''
        cp -r ${src} backend && chmod -R +w backend && cd backend
        export HOME=$TMPDIR
        ruff check .
        ruff format --check .
        PYTHONPATH=src pyright
        touch $out
      '';

  meta = {
    inherit (project) description;
    homepage = "https://github.com/tsandrini/puptrainer";
    license = lib.licenses.eupl12;
    platforms = lib.platforms.linux;
    mainProgram = "puptrainer-api";
  };
}

# --- flake-parts/shells/dev.nix
{
  lib,
  mkShell,
  nil,
  statix,
  deadnix,
  nix-output-monitor,
  nixfmt,
  commitizen,
  cz-cli,
  gh,
  markdownlint-cli,
  typos,
  python3,
  ruff,
  pyright,
  nodejs,
  prefetch-npm-deps,
  process-compose,
  pre-commit ? null,
}:
let
  pythonDeps = import ../pkgs/python-deps.nix;
  pythonEnv = python3.withPackages (
    ps: lib.unique (lib.concatLists (lib.attrValues (pythonDeps ps)))
  );
in
mkShell {
  packages = (lib.optional (pre-commit != null) pre-commit.settings.enabledPackages) ++ [
    # -- NIX UTILS --
    nil # Yet another language server for Nix
    statix # Lints and suggestions for the nix programming language
    deadnix # Find and remove unused code in .nix source files
    nix-output-monitor # Processes output of Nix commands to show helpful and pretty information
    nixfmt # An opinionated formatter for Nix

    # -- GIT RELATED UTILS --
    commitizen # Tool to create committing rules for projects, auto bump versions, and generate changelogs
    cz-cli # The commitizen command line utility
    gh # GitHub CLI tool

    # -- BASE LANG UTILS --
    markdownlint-cli # Command line interface for MarkdownLint
    typos # Source code spell checker

    # -- (YOUR) EXTRA PKGS --
    pythonEnv # the backend's dependencies, from nixpkgs
    ruff # Python linter and formatter
    pyright # Python type checker
    nodejs # the web app: `npm ci` and `npm run dev` in web/
    prefetch-npm-deps # `npmDepsHash` after a lock file change
    process-compose # `process-compose up`: API, worker and web dev server together
  ];

  shellHook = ''
    ${lib.optionalString (pre-commit != null) pre-commit.settings.shellHook}

    # NOTE: the backend runs from the source tree, uninstalled
    export PYTHONPATH="$PWD/backend/src''${PYTHONPATH:+:$PYTHONPATH}"

    # Welcome splash text
    echo ""; echo -e "\e[1;37;42mWelcome to the puptrainer devshell!\e[0m"; echo ""
  '';
}

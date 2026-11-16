# --- flake-parts/pre-commit-hooks.nix
{ inputs, ... }:
{
  imports = [ inputs.pre-commit-hooks.flakeModule ];

  perSystem =
    { pkgs, ... }:
    let
      # The web app's own toolchain (web/node_modules, `npm ci` in the devshell):
      # svelte-check, eslint and prettier with the Svelte plugin. Without a
      # node_modules (the sandboxed flake check) they step aside for
      # `checks.puptrainer-web-lint`.
      webTool =
        name: command:
        pkgs.writeShellScript "web-${name}" ''
          cd web || exit 1
          if [ ! -d node_modules/.bin ]; then
            echo "web/node_modules is missing (npm ci in web/): ${name} left to checks.puptrainer-web-lint" >&2
            exit 0
          fi
          export PATH="$PWD/node_modules/.bin:$PATH"
          ${command}
        '';
    in
    {
      pre-commit.settings = {
        excludes = [
          "flake.lock" # NOTE: prettier thinks this is json >.< prettier baka!!!
          "web/package-lock.json"
          "web/src/lib/api/types.ts" # NOTE: generated from the API's OpenAPI schema
        ];

        hooks = {
          # --- Nix ---
          deadnix.enable = true; # Find and remove unused code in .nix source files
          nil.enable = true; # Nix Language server, an incremental analysis assistant for writing in Nix.
          nixfmt.enable = true; # An opinionated formatter for Nix
          statix.enable = true; # Lints and suggestions for the nix programming language

          # --- Python ---
          ruff.enable = true; # An extremely fast Python linter
          ruff-format.enable = true; # An extremely fast Python formatter

          # --- Shell ---
          shellcheck.enable = true; # Shell script analysis tool
          shfmt.enable = true; # Shell parser and formatter

          # --- Misc ---
          markdownlint = {
            enable = true; # Markdown lint tool
            # NOTE: tables (prettier aligns them) and code may run past 80 columns
            settings.configuration.MD013 = {
              tables = false;
              code_blocks = false;
            };
          };
          editorconfig-checker.enable = true; # .editorconfig file checker
          typos.enable = true; # Source code spell checker
          prettier = {
            enable = true; # Prettier is an opinionated code formatter
            excludes = [ "^web/" ]; # its own prettier, with the Svelte plugin
          };
          check-toml.enable = true;

          # --- the web app (web/) ---
          svelte-check = {
            enable = true;
            name = "svelte-check";
            entry = "${webTool "svelte-check" "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --threshold error"}";
            files = "^web/";
            pass_filenames = false;
          };
          eslint-web = {
            enable = true;
            name = "eslint (web)";
            entry = "${webTool "eslint" "eslint ."}";
            files = "^web/";
            pass_filenames = false;
          };
          prettier-web = {
            enable = true;
            name = "prettier (web)";
            entry = "${webTool "prettier" "prettier --check ."}";
            files = "^web/";
            pass_filenames = false;
          };

          # --- fs utils ---
          check-symlinks.enable = true; # Check for broken symlinks
          check-added-large-files.enable = true;
          check-executables-have-shebangs.enable = true;
          check-shebang-scripts-are-executable.enable = true;
          end-of-file-fixer.enable = true;
          mixed-line-endings.enable = true;
          trim-trailing-whitespace.enable = true;

          # --- VCS ---
          commitizen.enable = true; # Commitizen is release management tool designed for teams.
          ripsecrets.enable = true; # A tool to prevent committing secret keys into your source code
        };
      };
    };
}

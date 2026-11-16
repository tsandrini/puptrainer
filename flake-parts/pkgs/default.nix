# --- flake-parts/pkgs/default.nix
{ config, ... }:
let
  inherit (config) flake-root;
in
{
  perSystem =
    { pkgs, config, ... }:
    {
      packages = {
        default = config.packages.puptrainer;

        puptrainer = pkgs.callPackage ./puptrainer.nix {
          inherit flake-root;
          inherit (config.packages) puptrainer-web;
        };
        puptrainer-web = pkgs.callPackage ./puptrainer-web.nix { inherit flake-root; };
      };

      checks = {
        # NOTE: ruff and pyright over backend/, no local environment needed
        puptrainer-lint = config.packages.puptrainer.lint;
        # NOTE: svelte-check, eslint, prettier and the unit tests over web/
        puptrainer-web-lint = config.packages.puptrainer-web.lint;
      };
    };
}

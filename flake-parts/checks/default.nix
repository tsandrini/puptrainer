# --- flake-parts/checks/default.nix
{
  config,
  lib,
  self,
  ...
}:
let
  inherit (config) flake-root;
in
{
  perSystem =
    {
      pkgs,
      config,
      system,
      ...
    }:
    {
      checks = lib.optionalAttrs (lib.hasSuffix "-linux" system) {
        e2e = pkgs.callPackage ./e2e.nix {
          inherit flake-root;
          inherit (config.packages) puptrainer;
        };
        # NOTE: the NixOS module on a machine like a user's
        vm = pkgs.testers.runNixOSTest (import ./vm.nix { inherit self; });
      };
    };
}

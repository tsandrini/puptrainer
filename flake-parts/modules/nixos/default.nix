# --- flake-parts/modules/nixos/default.nix
{
  config,
  inputs,
  self,
  ...
}:
let
  inherit (inputs.flake-parts.lib) importApply;
in
{
  config.flake.nixosModules = {
    puptrainer = importApply ./puptrainer.nix { localFlake = self; };
    default = config.flake.nixosModules.puptrainer;
  };
}

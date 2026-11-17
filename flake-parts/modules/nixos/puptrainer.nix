# --- flake-parts/modules/nixos/puptrainer.nix
# puptrainer as system services: the API (which also serves the web app) and
# the analysis worker. Both run on one machine by default; the worker only
# talks HTTP, so it can run elsewhere against `worker.apiUrl`.
#
# Without `tokenFile` the API is open and has to stay on a loopback address
# (an assertion enforces it). The recordings and the database live in
# /var/lib/puptrainer: back that directory up.
{ localFlake }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib)
    mkEnableOption
    mkIf
    mkOption
    types
    literalExpression
    hasPrefix
    optionalAttrs
    ;

  cfg = config.services.puptrainer;

  loopback =
    hasPrefix "127." cfg.bind || hasPrefix "[::1]" cfg.bind || hasPrefix "localhost" cfg.bind;

  # NOTE: the token reaches the services as a systemd credential, readable by them only
  credentials = optionalAttrs (cfg.tokenFile != null) {
    LoadCredential = [ "token:${cfg.tokenFile}" ];
  };
  tokenEnv = optionalAttrs (cfg.tokenFile != null) {
    PUPTRAINER_TOKEN_FILE = "%d/token";
  };

  hardening = {
    User = "puptrainer";
    Group = "puptrainer";
    Restart = "on-failure";
    RestartSec = 2;
    NoNewPrivileges = true;
    PrivateTmp = true;
    PrivateDevices = true;
    ProtectSystem = "strict";
    ProtectHome = true;
    ProtectKernelTunables = true;
    ProtectKernelModules = true;
    ProtectControlGroups = true;
    RestrictAddressFamilies = [
      "AF_INET"
      "AF_INET6"
      "AF_UNIX"
    ];
    LockPersonality = true;
  };
in
{
  options.services.puptrainer = {
    enable = mkEnableOption "puptrainer, the voice training companion";

    package = mkOption {
      type = types.package;
      default = localFlake.packages.${pkgs.stdenv.hostPlatform.system}.puptrainer;
      defaultText = literalExpression "puptrainer.packages.\${system}.puptrainer";
      description = "The package with `puptrainer-api` and `puptrainer-worker`.";
    };

    bind = mkOption {
      type = types.str;
      default = "127.0.0.1:8437";
      example = "0.0.0.0:8437";
      description = ''
        `host:port` the API listens on. Anything but a loopback address
        needs {option}`services.puptrainer.tokenFile`.
      '';
    };

    tokenFile = mkOption {
      type = types.nullOr types.path;
      default = null;
      example = "/run/agenix/puptrainer-token";
      description = ''
        A file holding the access token. With one set, the web app asks to
        sign in and the worker sends the token; without, the API is open.
        The file is passed to the services as a systemd credential, so it
        only has to be readable by root.
      '';
    };

    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Open the API's port in the firewall.";
    };

    api.enable = mkOption {
      type = types.bool;
      default = true;
      description = "Run the API (and the web app it serves) on this machine.";
    };

    worker = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Run the analysis worker on this machine.";
      };

      apiUrl = mkOption {
        type = types.str;
        default = "http://${
          if hasPrefix "0.0.0.0" cfg.bind then "127.0.0.1" + lib.removePrefix "0.0.0.0" cfg.bind else cfg.bind
        }";
        defaultText = literalExpression ''"http://''${config.services.puptrainer.bind}"'';
        example = "https://puptrainer.example.org";
        description = "Where the worker reaches the API.";
      };
    };
  };

  config = mkIf cfg.enable {
    assertions = [
      {
        assertion = !cfg.api.enable || loopback || cfg.tokenFile != null;
        message = ''
          services.puptrainer.bind = "${cfg.bind}" exposes the API beyond this machine:
          set services.puptrainer.tokenFile, or bind to 127.0.0.1.
        '';
      }
    ];

    users.users.puptrainer = {
      isSystemUser = true;
      group = "puptrainer";
      description = "puptrainer";
    };
    users.groups.puptrainer = { };

    networking.firewall.allowedTCPPorts = mkIf (cfg.api.enable && cfg.openFirewall) [
      (lib.toInt (lib.last (lib.splitString ":" cfg.bind)))
    ];

    systemd.services.puptrainer-api = mkIf cfg.api.enable {
      description = "puptrainer API and web app";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      environment = {
        PUPTRAINER_DATA_DIR = "/var/lib/puptrainer";
        PUPTRAINER_BIND = cfg.bind;
      }
      // tokenEnv;
      serviceConfig =
        hardening
        // credentials
        // {
          ExecStart = "${cfg.package}/bin/puptrainer-api";
          StateDirectory = "puptrainer";
          StateDirectoryMode = "0700";
          MemoryDenyWriteExecute = true;
        };
    };

    systemd.services.puptrainer-worker = mkIf cfg.worker.enable {
      description = "puptrainer analysis worker";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ] ++ lib.optional cfg.api.enable "puptrainer-api.service";
      environment = {
        PUPTRAINER_API_URL = cfg.worker.apiUrl;
      }
      // tokenEnv;
      serviceConfig =
        hardening
        // credentials
        // {
          ExecStart = "${cfg.package}/bin/puptrainer-worker";
        };
    };
  };
}

{
  inputs = {
    xnode-builders.url = "github:Openmesh-Network/xnode-builders";
  };
  nixConfig = {
    extra-substituters = [ "https://openmesh.cachix.org" ];
    extra-trusted-public-keys = [
      "openmesh.cachix.org-1:du4NDeMWxcX8T5GddfuD0s/Tosl3+6b+T2+CLKHgXvQ="
    ];
  };
  outputs =
    inputs:
    inputs.xnode-builders.language.auto {
      src = ./.;
      framework = "astro-node-noext";
      module = {
        options =
          { lib, ... }:
          {
            host = {
              option = { type = lib.types.str; default = "127.0.0.1"; description = "Host address to listen on."; };
              does = { value, service, ... }: service { environment.HOST = value; };
            };
            port = {
              option = { type = lib.types.port; default = 4375; description = "Port to listen on."; };
              does = { value, service, ... }: service { environment.PORT = builtins.toString value; };
            };
            ownerDomain = {
              option = {
                type = lib.types.nullOr lib.types.str;
                default = null;
                description = "Parent domain shared by the apps, so Nexy and the apps agree on the owner cookie. Null keeps it host-only.";
              };
              does =
                { value, service, ... }:
                service {
                  environment.OWN_OWNER_DOMAIN = if value == null then "" else value;
                };
            };

            trustXnodeAuth = {
              option = {
                type = lib.types.bool;
                default = false;
                description = "Use xnode-auth's signed-in identity as the owner, so data follows the person across devices. Enable ONLY where an xnode-auth block guards every path; otherwise Xnode-Auth-User is a header anyone can send. Nexy refuses to start with it unless it runs dist/server/serve.mjs on NEXY_SOCKET.";
              };
              does = { value, service, ... }: service { environment.NEXY_TRUST_XNODE_AUTH = if value then "1" else "0"; };
            };
            agentUrl = {
              option = {
                type = lib.types.str;
                default = "";
                description = "Nexy's own Hermes gateway. Empty falls back to llama-swap.";
              };
              does = { value, service, ... }: service { environment.NEXY_AGENT_URL = value; };
            };
            testAgentUrl = {
              option = {
                type = lib.types.str;
                default = "";
                description = "Gateway for eval turns only. Empty makes eval turns fail rather than reach the real gateway.";
              };
              does = { value, service, ... }: service { environment.NEXY_TEST_AGENT_URL = value; };
            };
            agentKey = {
              option = { type = lib.types.str; default = ""; description = "Bearer key for the gateway, if it requires one. Prefer agentKeyFile: this value is written to the Nix store, readable by every local user."; };
              does = { value, service, ... }: service { environment.NEXY_AGENT_KEY = value; };
            };
            agentKeyFile = {
              option = {
                type = lib.types.str;
                default = null;
                description = "File holding the gateway's bearer key, loaded as a systemd credential and kept out of the Nix store. Takes precedence over agentKey.";
              };
              does = { value, service, ... }: service {
                # %d: the unit's credentials directory
                environment.NEXY_AGENT_KEY_FILE = "%d/agent-key";
                serviceConfig.LoadCredential = [ "agent-key:${value}" ];
              };
            };
            socialDataDir = {
              option = {
                type = lib.types.str;
                default = "/var/lib/nexy/social";
                description = "Where the social autopilot keeps its JSON store.";
              };
              does = { value, service, ... }: service {
                environment.NEXY_SOCIAL_DATA_DIR = value;
                serviceConfig.StateDirectory = "nexy";
                serviceConfig.StateDirectoryMode = "0700";
              };
            };
            llmUrl = {
              option = {
                type = lib.types.str;
                default = "http://127.0.0.1:8080";
                description = "llama-swap, used only when no gateway is configured.";
              };
              does = { value, service, ... }: service { environment.NEXY_LLM_URL = value; };
            };
          }
          // (
            let
              appOpt = name: envVar: defaultUrl: {
                option = {
                  type = lib.types.str;
                  default = defaultUrl;
                  description = "Where Nexy reaches ${name}. Loopback today; a URL after the container split.";
                };
                does = { value, service, ... }: service { environment.${envVar} = value; };
              };
            in
            {
              qikiUrl = appOpt "Qiki" "NEXY_QIKI_URL" "http://127.0.0.1:4331";
              imagesUrl = appOpt "Own Image Studio" "NEXY_IMAGES_URL" "http://127.0.0.1:4335";
              beatUrl = appOpt "Own Beat Studio" "NEXY_BEAT_URL" "http://127.0.0.1:4340";
              voiceUrl = appOpt "Own Voice Studio" "NEXY_VOICE_URL" "http://127.0.0.1:4345";
              docsUrl = appOpt "Own Docs" "NEXY_DOCS_URL" "http://127.0.0.1:4360";
              startupUrl = appOpt "Own Startup" "NEXY_STARTUP_URL" "http://127.0.0.1:4371";
            }
          );
      };
    };
}

# Opt-in: publishing for a public demo deployment. Not imported by default.
{ config, lib, pkgs, ... }:
let
  domain = lib.removeSuffix "\n" (builtins.readFile (config.xnode.xnode-config + "/domain"));
  sites = "sites.${domain}";
in {
  config = lib.mkIf (domain != "") {
    systemd.services.nexy.environment = {
      NEXY_PUBLISHER_URL = "http://127.0.0.1:4390";
      NEXY_PUBLISH_SESSION_URL = "http://127.0.0.1:4321/api/demo-session";
      NEXY_PUBLISH_ORIGIN = "https://nexy.${domain}";
    };
    users.users.own-sites = { isSystemUser = true; group = "own-sites"; };
    users.groups.own-sites = {};
    systemd.tmpfiles.rules = [ "d /var/lib/own-sites/public 0755 own-sites own-sites -" ];
    systemd.services.own-sites-publisher = {
      description = "Conversation-scoped Nexy demo website publisher";
      wantedBy = [ "multi-user.target" ];
      after = [ "own-build.service" ];
      environment = {
        PORT = "4390";
        SITES_URL = "https://${sites}";
        SITES_DIR = "/var/lib/own-sites/public";
        OWN_BUILD_URL = "http://127.0.0.1:${toString config.services.own-build.port}";
        PUBLISH_TTL_HOURS = "6";
        PUBLISH_MAX_PER_OWNER = "3";
      };
      serviceConfig = {
        User = "own-sites";
        Group = "own-sites";
        ExecStart = "${pkgs.python3}/bin/python3 ${./demo-publisher.py}";
        Restart = "on-failure";
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        ReadWritePaths = [ "/var/lib/own-sites/public" ];
      };
    };
    services.nginx.virtualHosts.${sites} = {
      enableACME = true;
      forceSSL = true;
      root = "/var/lib/own-sites/public";
      locations."= /".return = "404";
      locations."~ ^/([a-z0-9][a-z0-9-]+)/?$" = {
        tryFiles = "/$1.html =404";
        extraConfig = ''
          default_type text/html;
          # No forms and no outbound requests: a page can show and link, never collect.
          add_header Content-Security-Policy "sandbox allow-scripts allow-popups; form-action 'none'; connect-src 'none'" always;
          add_header Cache-Control "no-cache" always;
          add_header X-Robots-Tag "noindex" always;
        '';
      };
      locations."/".return = "404";
    };
  };
}

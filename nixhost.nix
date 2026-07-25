{ pkgs }:
pkgs.buildNpmPackage {
  pname = "kitsy";
  version = "1.0.0";
  src = ./.;

  nodejs = pkgs.nodejs_24;
  npmDepsHash = "sha256-87FyN6oEHP9DkbfgCgv98EIchkcJJDmUn0Cz6YCtpcI=";
  npmDepsFetcherVersion = 2;

  nativeBuildInputs = [ pkgs.makeWrapper ];

  npmBuildScript = "build";

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/lib/kitsy" "$out/bin"
    npm prune --omit=dev --ignore-scripts --offline
    cp -R .output node_modules package.json "$out/lib/kitsy/"

    makeWrapper ${pkgs.nodejs_24}/bin/node "$out/bin/kitsy" \
      --chdir "$out/lib/kitsy" \
      --add-flags "--import ./.output/server/instrument.server.mjs" \
      --add-flags ".output/server/index.mjs"

    runHook postInstall
  '';

  meta = {
    description = "Local-first file and media toolbox";
    license = pkgs.lib.licenses.asl20;
    mainProgram = "kitsy";
  };
}

{
  description = "My dev shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
  let
    system = "x86_64-linux";
    pkgs = import nixpkgs { inherit system; };
  in {
    devShells.${system}.default = pkgs.mkShell {
      buildInputs = [
        pkgs.nodejs_24
        pkgs.zsh
      ];

      shellHook = ''
        npm install
        node -v
        npm -v
        npm run build 
        npm run start
      '';
    };
  };
}

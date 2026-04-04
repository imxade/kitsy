{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs_24
    pkgs.act
  ];

  shellHook = ''
    npm install
    node -v
    npm -v
    alias act-ci='act --container-architecture linux/amd64'
    alias dev='npm run dev'
    alias start='npm run build && npm start'
    alias test='npm run test'
    alias format='npm run format'
    alias g='git'
  '';
}
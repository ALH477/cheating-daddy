{
  description = "Cheating Daddy - AI Interview Assistant (Linux Production Build)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # RUNTIME DEPENDENCIES
        # These are injected into the app's library path via the wrapper.
        # This ensures the app works on minimal NixOS installs or other distros.
        runtimeLibs = with pkgs; [
          libsecret    # Required for secure token storage (keytar/etc)
          pulseaudio   # Provides 'parec' command (compatible with PipeWire)
          pipewire     # Core audio backend libraries
          alsa-lib     # Low-level audio fallback
          stdenv.cc.cc.lib # Standard C++ libs for native Node modules
          libuuid
        ];

      in
      {
        packages.default = pkgs.buildNpmPackage rec {
          pname = "cheating-daddy";
          version = "0.5.0";

          src = ./.;

          # IMPORTANT:
          # 1. Run 'nix build' once. It will fail.
          # 2. Copy the 'got: sha256-...' hash from the error message.
          # 3. Paste it here to lock your dependencies.
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

          # Production Flags
          makeCacheWritable = true; 
          dontNpmBuild = true; # Skip npm build step (we run source directly with system Electron)
          npmFlags = [ "--ignore-scripts" ];

          nativeBuildInputs = with pkgs; [
            makeWrapper
            copyDesktopItems
            pkg-config
            python3
          ];

          buildInputs = runtimeLibs;

          # Linux Desktop Integration (Start Menu Entry)
          desktopItems = [
            (pkgs.makeDesktopItem {
              name = "cheating-daddy";
              desktopName = "Cheating Daddy";
              genericName = "AI Interview Assistant";
              exec = "cheating-daddy";
              icon = "cheating-daddy";
              categories = [ "Development" "Education" ];
              comment = "AI assistant for interviews";
              startupWMClass = "cheating-daddy";
            })
          ];

          installPhase = ''
            runHook preInstall

            mkdir -p $out/lib/${pname} $out/bin
            
            # 1. Install Application Source
            cp -r . $out/lib/${pname}
            # Copy node_modules installed by buildNpmPackage
            cp -r node_modules $out/lib/${pname}/
            
            # 2. Cleanup: Remove bundled Electron binary to save ~100MB
            # We use the system-provided Electron instead.
            rm -rf $out/lib/${pname}/node_modules/electron

            # 3. Install Icon (Robust check for extension)
            if [ -f "src/assets/logo.png" ]; then
              install -Dm644 src/assets/logo.png $out/share/icons/hicolor/512x512/apps/${pname}.png
            elif [ -f "src/assets/logo" ]; then
              install -Dm644 src/assets/logo $out/share/icons/hicolor/512x512/apps/${pname}.png
            fi

            # 4. PRODUCTION WRAPPER
            # This is the "sanity" layer.
            # - Uses system Electron (version 30)
            # - Injects 'pulseaudio' (for parec) into PATH so it is ALWAYS found
            # - Injects 'bash' for the process aliasing trick in gemini.js
            # - Sets LD_LIBRARY_PATH so native modules find libsecret/alsa
            makeWrapper ${pkgs.electron_30}/bin/electron $out/bin/${pname} \
              --add-flags "$out/lib/${pname}" \
              --prefix PATH : "${pkgs.lib.makeBinPath [ pkgs.pulseaudio pkgs.bash ]}" \
              --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath runtimeLibs}" \
              --set ELECTRON_IS_DEV 0

            copyDesktopItems
            runHook postInstall
          '';
        };

        # Developer Environment (run 'nix develop')
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [ 
            nodejs_20 
            electron_30 
            pulseaudio 
          ];
          
          shellHook = ''
            export ELECTRON_OVERRIDE_DIST_PATH=${pkgs.electron_30}/bin/electron
            echo "🐧 Cheating Daddy Linux Dev Environment"
            echo "   - 'parec' is available for audio capture"
            echo "   - Run 'npm start' to launch"
          '';
        };
      }
    );
}

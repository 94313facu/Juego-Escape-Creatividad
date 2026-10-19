"""
Lanzador de Prison Escape 3D.

Levanta un servidor web local con la carpeta del juego y lo abre en el
navegador. Uso:

    python jugar.py            # puerto automático desde 8000
    python jugar.py 8080       # puerto fijo

Cerrar con Ctrl+C.
"""

import http.server
import mimetypes
import socket
import sys
import threading
import webbrowser
from functools import partial
from pathlib import Path

GAME_DIR = Path(__file__).resolve().parent

# En Windows el registro puede asociar .js a "text/plain", y el navegador se
# niega a cargar módulos ES con ese tipo: se fuerzan los tipos que usa el juego.
for ext, mime in {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".bin": "application/octet-stream",
    ".fbx": "application/octet-stream",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
}.items():
    mimetypes.add_type(mime, ext)


class GameHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      **{ext: mimetypes.types_map[ext] for ext in mimetypes.types_map}}

    def end_headers(self):
        # Sin caché: así siempre se ve la última versión de los archivos
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        pass  # Silenciar el log de cada archivo pedido


def free_port(start):
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("No hay puertos libres entre %d y %d" % (start, start + 49))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else free_port(8000)
    handler = partial(GameHandler, directory=str(GAME_DIR))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = "http://localhost:%d/" % port

    print("Prison Escape 3D")
    print("Sirviendo %s" % GAME_DIR)
    print("Abrí %s en el navegador (se abre solo). Ctrl+C para cerrar." % url)
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor cerrado.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

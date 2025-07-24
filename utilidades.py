import requests
import re

def playlist_deezer(id_playlist):
    url = f"https://api.deezer.com/playlist/{id_playlist}"
    response = requests.get(url)
    data = response.json()
    if "tracks" not in data:
        print(f"[ERROR] Respuesta inesperada de Deezer: {data}")
        return []
    canciones = []
    for cancion in data["tracks"]["data"]:
        if cancion["preview"]:
            canciones.append({
                "id": cancion.get("id", "?"),
                "title": cancion.get("title", "?"),
                "artist": cancion.get("artist", {}).get("name", "?"),
                "album": cancion.get("album", {}).get("title", "?"),
                "duration": cancion.get("duration", 0),
                "preview_url": cancion.get("preview", ""),
            })
    return canciones

def extraer_id_playlist(texto):
    m = re.search(r'playlist/(\d+)', texto)
    if m:
        return m.group(1)
    if texto.isdigit():
        return texto
    return None


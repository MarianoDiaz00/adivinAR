"""
Funciones auxiliares para interactuar con la API de Deezer
y para procesar entradas de playlist.
"""

import requests
import re
from typing import List, Dict, Optional


def playlist_deezer(id_playlist: str) -> List[Dict]:
    """
    Obtiene la lista de canciones de una playlist de Deezer.

    Parameters
    ----------
    id_playlist : str
        ID de la playlist en Deezer.

    Returns
    -------
    List[Dict]
        Lista de canciones con los campos:
        id, title, artist, album, duration, preview_url.
    """
    url = f"https://api.deezer.com/playlist/{id_playlist}"
    response = requests.get(url)
    data = response.json()

    if "tracks" not in data:
        print(f"[ERROR] Respuesta inesperada de Deezer: {data}")
        return []

    canciones = []
    for cancion in data["tracks"]["data"]:
        if cancion.get("preview"):  # Filtra canciones con preview
            canciones.append({
                "id": cancion.get("id", "?"),
                "title": cancion.get("title", "?"),
                "artist": cancion.get("artist", {}).get("name", "?"),
                "album": cancion.get("album", {}).get("title", "?"),
                "duration": cancion.get("duration", 0),
                "preview_url": cancion.get("preview", ""),
            })
    return canciones


def extraer_id_playlist(texto: str) -> Optional[str]:
    """
    Extrae el ID de una playlist desde un texto o URL.

    Parameters
    ----------
    texto : str
        Texto que puede contener un número o URL con 'playlist/{id}'.

    Returns
    -------
    str or None
        El ID de la playlist si se encuentra, de lo contrario None.
    """
    m = re.search(r'playlist/(\d+)', texto)
    if m:
        return m.group(1)
    if texto.isdigit():
        return texto
    return None
"""
Lógica del juego: normalización de entradas y validación de respuestas.
"""

import unicodedata
from typing import Dict


class GameSession:
    """
    Representa una sesión de juego para una canción.
    """

    def __init__(self, cancion: Dict):
        """
        Parameters
        ----------
        cancion : dict
            Información de la canción (title, artist, album, etc.).
        """
        self.cancion = cancion

    def check_guess(self, guess: str) -> bool:
        """
        Verifica si la respuesta del usuario coincide con la canción.

        Parameters
        ----------
        guess : str
            Respuesta ingresada por el usuario.

        Returns
        -------
        bool
            True si la respuesta es correcta, False en caso contrario.
        """
        guess_norm = self.normalizar(guess)
        title_norm = self.normalizar(self.cancion['title'])
        artist_norm = self.normalizar(self.cancion['artist'])

        variantes = {
            title_norm,
            f"{title_norm} - {artist_norm}",
            f"{title_norm} {artist_norm}",
            f"{artist_norm} - {title_norm}",
            f"{artist_norm} {title_norm}",
        }

        return guess_norm in variantes

    @staticmethod
    def normalizar(txt: str) -> str:
        """
        Normaliza el texto: minúsculas, sin acentos, sin puntuación.

        Parameters
        ----------
        txt : str
            Texto a normalizar.

        Returns
        -------
        str
            Texto limpio y normalizado.
        """
        txt = txt.lower().strip()
        txt = "".join(
            c for c in unicodedata.normalize('NFD', txt)
            if unicodedata.category(c) != 'Mn'
        )
        for sep in [",", ".", ";", "(", ")", "!", "?", "¡", "¿", "\"", "'", "-"]:
            txt = txt.replace(sep, " ")
        txt = txt.replace("&", "y")
        return " ".join(txt.split())
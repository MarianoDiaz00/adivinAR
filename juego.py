import unicodedata
from typing import Dict, List, Tuple


class GameSession:
    """La ronda de una canción: evaluar la respuesta y generar las pistas."""

    def __init__(self, cancion: Dict):
        self.cancion = cancion

    def evaluar(self, guess: str) -> Tuple[bool, bool]:
        """Evalúa una respuesta.

        Returns
        -------
        (correcto, parcial)
            correcto : acertó el título (con o sin el artista).
            parcial  : NO acertó, pero la respuesta menciona al artista.
        """
        correcto = self.check_guess(guess)
        parcial = (not correcto) and self._menciona_artista(guess)
        return correcto, parcial

    def check_guess(self, guess: str) -> bool:
        """True si la respuesta coincide con el título y/o el artista."""
        guess_norm = self.normalizar(guess)
        title_norm = self.normalizar(self.cancion["title"])
        artist_norm = self.normalizar(self.cancion["artist"])

        variantes = {
            title_norm,
            f"{title_norm} {artist_norm}",
            f"{artist_norm} {title_norm}",
        }
        return guess_norm in variantes

    def _menciona_artista(self, guess: str) -> bool:
        """True si la respuesta contiene el nombre del artista (normalizado)."""
        artist_norm = self.normalizar(self.cancion["artist"])
        if not artist_norm:
            return False
        return artist_norm in self.normalizar(guess)

    def generar_pistas(self, intento: int) -> List[str]:
        """Pistas progresivas según el número de intento."""
        pistas: List[str] = []
        if intento >= 2:
            pistas.append("❌ Respuesta incorrecta, seguí intentando.")
        if intento >= 3:
            mm, ss = divmod(self.cancion["duration"], 60)
            pistas.append(f"Duración: {mm}:{ss:02d}")
        if intento >= 4:
            pistas.append(f"Álbum: {self.cancion['album']}")
        if intento >= 5:
            pistas.append(f"Artista: {self.cancion['artist']}")
        return pistas

    @staticmethod
    def normalizar(txt: str) -> str:
        """Minúsculas, sin acentos ni puntuación, espacios colapsados."""
        txt = txt.lower().strip()
        txt = "".join(
            c for c in unicodedata.normalize("NFD", txt)
            if unicodedata.category(c) != "Mn"
        )
        for sep in [",", ".", ";", "(", ")", "!", "?", "¡", "¿", '"', "'", "-"]:
            txt = txt.replace(sep, " ")
        txt = txt.replace("&", "y")
        return " ".join(txt.split())
import unicodedata

class GameSession:
    def __init__(self, cancion):
        self.cancion = cancion

    def check_guess(self, guess):
        guess_norm = self.normalizar(guess)
        title_norm = self.normalizar(self.cancion['title'])
        artist_norm = self.normalizar(self.cancion['artist'])

        variantes = [
            title_norm,
            f"{title_norm} - {artist_norm}",
            f"{title_norm} {artist_norm}",
            f"{artist_norm} - {title_norm}",
            f"{artist_norm} {title_norm}",
        ]

        return guess_norm in variantes or any(guess_norm == v for v in variantes)

    @staticmethod
    def normalizar(txt):
        txt = txt.lower().strip()
        txt = "".join(
            c for c in unicodedata.normalize('NFD', txt)
            if unicodedata.category(c) != 'Mn'
        )
        for sep in [",", ".", ";", "(", ")", "!", "?", "¡", "¿", "\"", "'", "-"]:
            txt = txt.replace(sep, " ")
        txt = txt.replace("&", "y")
        # Reemplaza múltiples espacios por uno solo
        txt = " ".join(txt.split())
        return txt
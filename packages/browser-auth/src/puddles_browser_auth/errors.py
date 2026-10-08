class AuthError(Exception):
    """Safe categorical error; never include browser or provider diagnostics."""

    def __init__(self, code):
        self.code = code
        super().__init__(code)

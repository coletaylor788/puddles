class GatewayError(Exception):
    """Only stable codes cross the process boundary; never serialize underlying exceptions."""

    def __init__(self, code: str, outcome: str | None = None):
        self.code = code
        self.outcome = outcome
        super().__init__(code)

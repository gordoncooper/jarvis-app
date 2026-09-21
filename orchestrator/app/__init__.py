"""Product orchestrator (D-0020)."""

import os

# Stamped by the image build (JARVIS_VERSION build arg). /health has to answer
# "which build is this?" honestly — it reported a hardcoded 0.6.18 through five
# releases, which makes a deploy impossible to verify from the outside.
__version__ = os.environ.get("JARVIS_VERSION", "dev")

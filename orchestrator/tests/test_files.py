import os
import time
import unittest
from pathlib import Path

from app.files import list_folder
from app.router import route


class ListFolderTest(unittest.TestCase):
    def test_an_empty_folder_says_so(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            text, data = list_folder(Path(tmp), now=time.time())
        self.assertEqual(text, "The files folder is empty.")
        self.assertEqual(data["entries"], [])

    def test_contents_are_not_read(self) -> None:
        import tempfile

        now = time.time()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "notes.txt").write_text("password=swordfish\n", encoding="utf-8")
            outside = root.parent / "secret-outside.txt"
            outside.write_text("token=do-not-follow", encoding="utf-8")
            try:
                os.symlink(outside, root / "escape")
                text, data = list_folder(root, now=now)
            finally:
                outside.unlink(missing_ok=True)
        self.assertNotIn("swordfish", text)
        self.assertNotIn("do-not-follow", text)
        self.assertNotIn("secret-outside", text)
        names = [row["name"] for row in data["entries"]]
        self.assertEqual(names, ["escape", "notes.txt"])
        kinds = {row["name"]: row["kind"] for row in data["entries"]}
        self.assertEqual(kinds["escape"], "link")
        self.assertEqual(kinds["notes.txt"], "file")
        self.assertIn("notes.txt", text)
        self.assertIn("a link", text)

    def test_a_missing_folder_is_not_invented(self) -> None:
        text, data = list_folder(Path("/tmp/jarvis-files-does-not-exist"), now=time.time())
        self.assertIn("not there", text)
        self.assertEqual(data["entries"], [])

    def test_the_original_question_lists_the_folder(self) -> None:
        self.assertEqual(
            route("what files do you have listed in the directory?").label,
            "files.list",
        )

    def test_a_question_about_files_in_general_stays_chat(self) -> None:
        self.assertEqual(route("what is a file?").label, "chat")
        self.assertEqual(route("what is a log file?").label, "chat")

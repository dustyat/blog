import unittest
import sys
from pathlib import Path

# Add scripts to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from sync_and_replace_assets import replace_images_in_content


class TestImageReplacement(unittest.TestCase):
    def setUp(self):
        self.cdn_base_url = "https://img.yourdomain.com/attachments"
        self.fake_path = Path("fake_post.md")

    def test_standard_markdown_relative_path(self):
        content = "Here is an image: ![My Image](./attachments/photo.png)"
        new_content, reps = replace_images_in_content(
            content, self.cdn_base_url, self.fake_path
        )
        self.assertEqual(len(reps), 1)
        self.assertIn("![My Image](https://img.yourdomain.com/attachments/photo.png)", new_content)

    def test_obsidian_wikilink_simple(self):
        content = "Obsidian paste: ![[screenshot.png]]"
        new_content, reps = replace_images_in_content(
            content, self.cdn_base_url, self.fake_path
        )
        self.assertEqual(len(reps), 1)
        self.assertIn("![screenshot](https://img.yourdomain.com/attachments/screenshot.png)", new_content)

    def test_obsidian_wikilink_alias(self):
        content = "Obsidian alias: ![[diagram.png|Architecture Diagram]]"
        new_content, reps = replace_images_in_content(
            content, self.cdn_base_url, self.fake_path
        )
        self.assertEqual(len(reps), 1)
        self.assertIn("![Architecture Diagram](https://img.yourdomain.com/attachments/diagram.png)", new_content)

    def test_obsidian_wikilink_dimension(self):
        content = "Obsidian resized: ![[photo.jpg|800]]"
        new_content, reps = replace_images_in_content(
            content, self.cdn_base_url, self.fake_path
        )
        self.assertEqual(len(reps), 1)
        self.assertIn("![photo](https://img.yourdomain.com/attachments/photo.jpg)", new_content)

    def test_obsidian_non_image_wikilink(self):
        content = "Refer to [[Other Article]] for more details."
        new_content, reps = replace_images_in_content(
            content, self.cdn_base_url, self.fake_path
        )
        self.assertEqual(len(reps), 0)
        self.assertEqual(new_content, content)

    def test_external_url_untouched(self):
        content = "External: ![External](https://cdn.example.com/images/pic.png)"
        new_content, reps = replace_images_in_content(
            content, self.cdn_base_url, self.fake_path
        )
        self.assertEqual(len(reps), 0)
        self.assertEqual(new_content, content)

    def test_code_blocks_protected(self):
        content = """Before code

```markdown
![alt](./attachments/code_example.png)
![[inside_code.png]]
```

After code: ![[outside.png]]
"""
        new_content, reps = replace_images_in_content(
            content, self.cdn_base_url, self.fake_path
        )
        self.assertEqual(len(reps), 1)
        self.assertIn("![alt](./attachments/code_example.png)", new_content)
        self.assertIn("![[inside_code.png]]", new_content)
        self.assertIn("![outside](https://img.yourdomain.com/attachments/outside.png)", new_content)

    def test_inline_code_protected(self):
        content = "Do not replace `![alt](./attachments/code.png)` in inline code. But replace ![[real.png]]."
        new_content, reps = replace_images_in_content(
            content, self.cdn_base_url, self.fake_path
        )
        self.assertEqual(len(reps), 1)
        self.assertIn("`![alt](./attachments/code.png)`", new_content)
        self.assertIn("![real](https://img.yourdomain.com/attachments/real.png)", new_content)

    def test_various_relative_paths(self):
        cases = [
            ("![a](../../assets/pic1.png)", "https://img.yourdomain.com/attachments/pic1.png"),
            ("![b](attachments/pic2.jpg)", "https://img.yourdomain.com/attachments/pic2.jpg"),
            ("![c](./attachments/sub/pic3.webp)", "https://img.yourdomain.com/attachments/sub/pic3.webp"),
        ]
        for src, expected_url in cases:
            new_content, reps = replace_images_in_content(
                src, self.cdn_base_url, self.fake_path
            )
            self.assertEqual(len(reps), 1)
            self.assertIn(expected_url, new_content)


if __name__ == "__main__":
    unittest.main()

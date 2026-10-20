#!/usr/bin/env python3
"""Retired public Knowledge Base generator: private content belongs in Supabase.

This command intentionally makes no file changes. The former generator wrote
public category bodies and replaced the entire shared sidebar. Running it after
the private Knowledge Base migration would undo its security and navigation.
"""
import argparse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    parser.exit(2,
        "Retired: generate_kb_indexes.py no longer writes public KB content or the sidebar.\n"
        "Author/import category and article content in the private hq_knowledge_pages table;\n"
        "keep public pages as protected data-knowledge-page shells. See\n"
        "supabase/Knowledge-base-security.md. To rebuild public link metadata only, run\n"
        "python3 scripts/build-navigation.py. Existing pages and sidebar are unchanged.\n")


if __name__ == '__main__':
    main()

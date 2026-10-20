#!/usr/bin/env python3
"""Retired: Knowledge Base search prose is authenticated Supabase data."""
import argparse

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    parser.exit(2, 'Retired: public search prose must not be regenerated. Search uses private hq_knowledge_pages records. See supabase/Knowledge-base-security.md.\n')

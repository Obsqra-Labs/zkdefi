#!/usr/bin/env python3
"""
Run the relayer runner as a standalone process.
"""
import asyncio
import logging

from app.services.relayer_runner import RelayerRunner


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
    runner = RelayerRunner.from_env()
    asyncio.run(runner.run_forever())


if __name__ == "__main__":
    main()

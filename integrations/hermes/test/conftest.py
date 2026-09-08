def pytest_addoption(parser):
    parser.addoption("--cairn-executable", required=True)
    parser.addoption("--cairn-node", required=True)

# Portfolio Owner export and import authority

Exporting a Portfolio Snapshot requires Portfolio Owner authority because Snapshots include Secrets and full Portfolio orchestration history. In the v1 server app, the Workspace Owner is also the Portfolio Owner for the Workspace's default Portfolio; importing a Snapshot into a Workspace requires Workspace Owner authority and the importer becomes the Portfolio Owner for the created Portfolio. Future consumers may infer Portfolio Owner authority differently.

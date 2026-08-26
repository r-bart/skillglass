# Forge

Forge is an open-source desktop application for discovering, inspecting, installing, and safely updating agent skills.

The project is currently in its product-contract and implementation-planning phase.

## Official downloads

Official Forge binaries will be published **only as release assets in this source repository**.

Do not download Forge binaries from third-party websites, mirrors, app stores, or unrelated domains. A direct link to the repository's Releases section will be added when the first public release is available.

## Safety boundaries

- Forge reads installed skills and may install or update them only inside user-approved, user-writable roots.
- Forge never activates or deactivates skills; users manage runtime state through their own harnesses.
- Forge never requests administrator, root, or operating-system elevation.

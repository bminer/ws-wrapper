# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.2.0] - 2026-04-16

### Added

- Anonymous (request-scoped) channels.
- `WebSocketChannel[Symbol.asyncIterator]`.
- `iterableHandler(fn)` handler wrapper.
- Custom `messageEncode` / `messageDecode` options.
- Additional integration test coverage.

### Changed

- Split API and wire protocol documentation into dedicated documents.
- Updated README and TypeScript definitions.
- Updated lint configuration and upgraded ESLint to v10.

### Fixed

- Request cancellation when a request resolves to an anonymous channel.
- Async iterator behavior in edge cases.
- Channel abort/close handling, including close reason support.
- Example/test lint issues and compatibility with Node 14 lint target.

## [4.1.0] - 2026-03-29

### Added

- See 4.0.0 below for further details.

### Changed

- Redesigned encoding of rejection and cancellation payloads.

### Fixed

- `package.json` example-app bundling configuration.

## [4.0.0] - 2026-03-28 [YANKED]

### Added

- TypeScript declarations file.
- Initial automated test suite.
- Request cancellation support and error classes.

### Changed

- Updated dependencies.
- Node.js 14+ is now explicitly required.
- README cleanup and linter configuration updates.

### Fixed

- Validation for `options.requestTimeout`.
- Validation for sockets passed to `wrapper.bind()`.
- Pending-message send behavior.

## [3.0.3] - 2025-05-18

### Changed

- Updated dependencies.

## [3.0.2] - 2025-01-27

### Changed

- Added `"connect"` to `NO_WRAP_EVENTS`.
- Added Go server-wrapper reference in the README.
- Ran Prettier formatting on Markdown.

### Fixed

- Convert string `msg.e` values into `Error` instances.
- README typo fixes.

## [3.0.1] - 2025-01-18

### Added

- Added `index.mjs` entrypoint.

## [3.0.0] - 2025-01-17

### Changed

- Migrated package to ES Modules.
- Migrated example app build to Parcel.
- Improved ESLint configuration.
- Code formatting updates.

### Fixed

- Example app bug fixes.

[unreleased]: https://github.com/bminer/ws-wrapper/compare/v4.2.0...HEAD
[4.2.0]: https://github.com/bminer/ws-wrapper/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/bminer/ws-wrapper/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/bminer/ws-wrapper/compare/v3.0.3...v4.0.0
[3.0.3]: https://github.com/bminer/ws-wrapper/compare/v3.0.2...v3.0.3
[3.0.2]: https://github.com/bminer/ws-wrapper/compare/v3.0.1...v3.0.2
[3.0.1]: https://github.com/bminer/ws-wrapper/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/bminer/ws-wrapper/releases/tag/v3.0.0

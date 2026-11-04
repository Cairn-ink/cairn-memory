Acorn 8.15.0, vendored unchanged from `package/dist/acorn.mjs` in the npm
release, with its MIT license. Used only by the event-time static test gate;
no runtime or installation dependency is added.

Source: https://registry.npmjs.org/acorn/-/acorn-8.15.0.tgz
Release archive integrity (verified before extraction):
`sha512-NZyJarBfL7nWwIq+FDL6Zp/yHEhePMNnnJ0y3qfieCrmNvYct8uvtiV41UvlSe6apAfk0fY1FbWx+NwfmpvtTg==`

Keep the parser and license together when updating. Unsupported production
syntax must fail the audit rather than fall back to regular expressions.

set positional-arguments

# Maintainer screenshot packet. See CONTRIBUTING.md for prerequisites.
ui-capture *args:
    node scripts/ui-capture/capture.mjs "$@"

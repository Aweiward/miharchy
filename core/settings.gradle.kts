rootProject.name = "miharchy-core"

include("host")
include("server")

// The sync merge and Mihon's backup classes, used in place (ADR 0010). sync/ does not change, so the helper's
// fingerprint stays; Gradle's output in sync/build is outside it.
includeBuild("../sync") {
    dependencySubstitution { substitute(module("miharchy:miharchy-sync")).using(project(":")) }
}

rootProject.name = "miharchy-core"

include("host")
include("server")

// The sync merge and Mihon's backup classes, used in place (ADR 0010). Setup's core fingerprint covers sync/ too;
// Gradle's output in sync/build is outside it.
includeBuild("../sync") {
    dependencySubstitution { substitute(module("miharchy:miharchy-sync")).using(project(":")) }
}

// The one place this package reaches its workspace siblings. Until the root lockfile links
// @chatdom/emotes, imports go through the sibling source; main swaps this line for the
// package specifier when it registers the workspace dependency.
export * from '../../shared/src/index';

# Asset review version links

Signed-in reviewers can open a specific ready version with:

`/projects/<project-id>/assets/<asset-id>?versionId=<version-uuid>`

The asset version must be returned by the authenticated asset's version list and be ready for review. A missing, deleted, foreign, or unfinished version shows an unavailable message; the page does not open another version under that link. Reviewers can choose a ready version in the switcher or clear the link to open the latest available version.

`commentId=<comment-uuid>` can be added to focus a comment on the linked version. Copied comment links include both IDs. Switching versions clears `commentId`, since it belongs to the previous version. Compare settings stay in the URL when versions change.

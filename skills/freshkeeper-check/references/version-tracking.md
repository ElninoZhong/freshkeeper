# Local and bundled source evidence

The checker recovers public GitHub sources through its verified catalog and official-tree comparison. When a Skill was authored locally or distributed inside an installed application, supply `--source-map <json-path>` together with `--fill-metadata`.

```json
{
  "version": 1,
  "sources": {
    "personal-skill": {
      "sourceType": "local",
      "source": "local-authoring",
      "evidence": ["/absolute/path/to/creation-record.md"]
    },
    "vendor-skill": {
      "sourceType": "bundled",
      "source": "Vendor application bundled Skill",
      "sourcePath": "/absolute/path/to/application/skills/vendor-skill",
      "evidence": ["/absolute/path/to/application/skills/vendor-skill/SKILL.md"]
    }
  }
}
```

Only use `local` after creation records or source materials prove local authorship. Failure to find a public repository is not proof of local authorship. Each evidence file must exist and identify the Skill. The script checks these minimal structural conditions; the agent must assess the actual provenance evidence before supplying the map.

For `bundled`, compare the complete application-owned Skill directory. The application version is not automatically the installed Skill version. Preserve local modifications and report differing directories as requiring a merge. Never update the application through this Skill.

The metadata writer stores the evidence paths and content baseline. Subsequent checks reuse these records and verify the evidence. If evidence paths move or disappear, restore the evidence pointer rather than substituting an unrelated source.

`installedVersion` is the observed content revision; `installedDeclaredVersion` is a version explicitly declared by the installed Skill. `upstreamVersion` is observed separately. A SHA-256 identifier is a reproducible content revision, not a fabricated release number. Repeating metadata fill preserves `baselineSnapshotHash` and records the latest observation separately, so local drift remains visible.

The official file-list comparison supports legacy well-known indexes listing individual files. Unsupported archive/index formats and missing files produce explicit check errors. It never fetches a guessed same-name source or treats network failure as current.

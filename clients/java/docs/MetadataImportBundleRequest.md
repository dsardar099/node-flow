

# MetadataImportBundleRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**bundle** | **Map&lt;String, Object&gt;** |  |  |
|**workflowConflicts** | [**WorkflowConflictsEnum**](#WorkflowConflictsEnum) |  |  [optional] |
|**taskDefinitionConflicts** | [**TaskDefinitionConflictsEnum**](#TaskDefinitionConflictsEnum) |  |  [optional] |
|**dryRun** | **Boolean** |  |  [optional] |



## Enum: WorkflowConflictsEnum

| Name | Value |
|---- | -----|
| SKIP | &quot;skip&quot; |
| NEW_VERSION | &quot;new-version&quot; |



## Enum: TaskDefinitionConflictsEnum

| Name | Value |
|---- | -----|
| SKIP | &quot;skip&quot; |
| OVERWRITE | &quot;overwrite&quot; |




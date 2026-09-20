

# PermissionsPutRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**subjectType** | [**SubjectTypeEnum**](#SubjectTypeEnum) |  |  |
|**subjectId** | **UUID** |  |  |
|**resourceType** | [**ResourceTypeEnum**](#ResourceTypeEnum) |  |  |
|**resource** | **String** |  |  |
|**access** | [**List&lt;AccessEnum&gt;**](#List&lt;AccessEnum&gt;) |  |  |



## Enum: SubjectTypeEnum

| Name | Value |
|---- | -----|
| USER | &quot;USER&quot; |
| GROUP | &quot;GROUP&quot; |
| APPLICATION | &quot;APPLICATION&quot; |



## Enum: ResourceTypeEnum

| Name | Value |
|---- | -----|
| WORKFLOW | &quot;WORKFLOW&quot; |
| TASK_DEFINITION | &quot;TASK_DEFINITION&quot; |



## Enum: List&lt;AccessEnum&gt;

| Name | Value |
|---- | -----|
| READ | &quot;READ&quot; |
| EXECUTE | &quot;EXECUTE&quot; |
| UPDATE | &quot;UPDATE&quot; |
| DELETE | &quot;DELETE&quot; |




# MetadataUpsertTaskDefinitionRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**description** | **str** |  | [optional] 
**input_keys** | **List[str]** |  | [optional] [default to []]
**output_keys** | **List[str]** |  | [optional] [default to []]
**input_schema** | **object** |  | [optional] 
**output_schema** | **object** |  | [optional] 
**secret_output_fields** | **List[str]** |  | [optional] [default to []]
**owner_email** | **str** |  | [optional] 
**retry_count** | **int** |  | [optional] [default to 3]
**retry_logic** | **str** |  | [optional] [default to 'EXPONENTIAL_BACKOFF']
**retry_delay_seconds** | **float** |  | [optional] [default to 1]
**backoff_scale_factor** | **float** |  | [optional] [default to 2]
**max_retry_delay_seconds** | **float** |  | [optional] [default to 3600]
**jitter** | **float** |  | [optional] [default to 0.2]
**retry_budget** | **float** |  | [optional] [default to 0.3]
**non_retryable_errors** | **List[str]** |  | [optional] [default to []]
**timeout_seconds** | **float** |  | [optional] [default to 0]
**schedule_to_start_timeout** | **float** |  | [optional] [default to 0]
**start_to_close_timeout** | **float** |  | [optional] [default to 0]
**heartbeat_timeout** | **float** |  | [optional] [default to 0]
**response_timeout_seconds** | **float** |  | [optional] [default to 3600]
**poll_timeout_seconds** | **float** |  | [optional] [default to 30]
**timeout_policy** | **str** |  | [optional] [default to 'TIME_OUT_WF']
**concurrent_exec_limit** | **int** |  | [optional] [default to 0]
**rate_limit_per_frequency** | **int** |  | [optional] [default to 0]
**rate_limit_frequency_seconds** | **int** |  | [optional] [default to 1]
**semaphores** | **List[str]** |  | [optional] [default to []]

## Example

```python
from node_flow_client.models.metadata_upsert_task_definition_request import MetadataUpsertTaskDefinitionRequest

# TODO update the JSON string below
json = "{}"
# create an instance of MetadataUpsertTaskDefinitionRequest from a JSON string
metadata_upsert_task_definition_request_instance = MetadataUpsertTaskDefinitionRequest.from_json(json)
# print the JSON string representation of the object
print(MetadataUpsertTaskDefinitionRequest.to_json())

# convert the object into a dict
metadata_upsert_task_definition_request_dict = metadata_upsert_task_definition_request_instance.to_dict()
# create an instance of MetadataUpsertTaskDefinitionRequest from a dict
metadata_upsert_task_definition_request_from_dict = MetadataUpsertTaskDefinitionRequest.from_dict(metadata_upsert_task_definition_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



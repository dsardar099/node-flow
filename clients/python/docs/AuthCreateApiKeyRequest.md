# AuthCreateApiKeyRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**scopes** | **List[str]** |  | [optional] [default to []]
**expires_at** | **datetime** |  | [optional] 

## Example

```python
from node_flow_client.models.auth_create_api_key_request import AuthCreateApiKeyRequest

# TODO update the JSON string below
json = "{}"
# create an instance of AuthCreateApiKeyRequest from a JSON string
auth_create_api_key_request_instance = AuthCreateApiKeyRequest.from_json(json)
# print the JSON string representation of the object
print(AuthCreateApiKeyRequest.to_json())

# convert the object into a dict
auth_create_api_key_request_dict = auth_create_api_key_request_instance.to_dict()
# create an instance of AuthCreateApiKeyRequest from a dict
auth_create_api_key_request_from_dict = AuthCreateApiKeyRequest.from_dict(auth_create_api_key_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



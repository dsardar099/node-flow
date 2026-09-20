# AuthCreateServiceAccountRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**scopes** | **List[str]** |  | [optional] [default to []]

## Example

```python
from node_flow_client.models.auth_create_service_account_request import AuthCreateServiceAccountRequest

# TODO update the JSON string below
json = "{}"
# create an instance of AuthCreateServiceAccountRequest from a JSON string
auth_create_service_account_request_instance = AuthCreateServiceAccountRequest.from_json(json)
# print the JSON string representation of the object
print(AuthCreateServiceAccountRequest.to_json())

# convert the object into a dict
auth_create_service_account_request_dict = auth_create_service_account_request_instance.to_dict()
# create an instance of AuthCreateServiceAccountRequest from a dict
auth_create_service_account_request_from_dict = AuthCreateServiceAccountRequest.from_dict(auth_create_service_account_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



# UserCreateUserRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**email** | **str** |  | 
**name** | **str** |  | 
**password** | **str** |  | 
**scopes** | **List[str]** |  | [optional] [default to []]

## Example

```python
from node_flow_client.models.user_create_user_request import UserCreateUserRequest

# TODO update the JSON string below
json = "{}"
# create an instance of UserCreateUserRequest from a JSON string
user_create_user_request_instance = UserCreateUserRequest.from_json(json)
# print the JSON string representation of the object
print(UserCreateUserRequest.to_json())

# convert the object into a dict
user_create_user_request_dict = user_create_user_request_instance.to_dict()
# create an instance of UserCreateUserRequest from a dict
user_create_user_request_from_dict = UserCreateUserRequest.from_dict(user_create_user_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)



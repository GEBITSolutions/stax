#!/bin/bash

set -e # Stop on first error
echo -e "Args Vars:\n${3}"
echo -e "Args Secr:\n${4}"
echo -e "Output Vars:\n${5}"
echo -e "Output Secr:\n${6}"

eval $(echo "${3}")
eval $(echo "${4}")

echo "DEPLOYMENT_NAME=$1"
echo "DRY_RUN=$2"
export DEPLOYMENT_NAME=$1
export DRY_RUN=$2

PARAMETERS=$(env | grep "^PARAM" | sed 's/^PARAM_//' | tr '\n' ' ' | tr [:upper:] [:lower:])

echo -e "RESOURCE_GROUP=$RESOURCE_GROUP"
echo -e "TEMPLATE_FILE=$TEMPLATE_FILE"
echo -e "PARAMETERS=$PARAMATERS"
echo -e "DEPLOYMENT_NAME=$DEPLOYMENT_NAME"



echo '====> Script Start ============================>'

if [ "$LOCAL_RUN" != "true" ]; then
    bash "${GITHUB_WORKSPACE}/.github/scripts/az-login.sh"
fi
is_logged_in=$(az account show -o json)

echo "Login success for Subscription ID: $ARM_SUBSCRIPTION_ID"

if [ "$DRY_RUN" = "true" ]; then
    echo "Dry run only, skipping deployment."
     dgp_cmd=" what-if "
else
    dgp_cmd="create"
fi
echo "Creating new deployment..."
echo "Executing... az deployment group $dgp_cmd --name $DEPLOYMENT_NAME --resource-group $RESOURCE_GROUP --template-file $TEMPLATE_FILE --parameters $PARAMETERS"
output=$(az deployment group $dgp_cmd --name $DEPLOYMENT_NAME --resource-group $RESOURCE_GROUP --template-file $TEMPLATE_FILE --parameters $PARAMETERS -o json)
if [ "$DRY_RUN" != "true" ]; then
    echo "Deployment $( echo $output | jq -rc  '.properties.provisioningState')"
    echo "script_out=$(echo $output | jq '.properties.outputs | to_entries | map({(.key): .value.value}) | add | tojson')" >> "$GITHUB_OUTPUT"
fi



echo '====> Script Finished =========================>'
exit 0
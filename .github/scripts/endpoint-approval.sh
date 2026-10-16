#!/bin/bash

set -e # Stop on first error
echo -e "Args:\n${1}"
eval $(echo "${1}")


echo "resource_id=$resource_id"
echo "endpoint_id=$endpoint_id"

echo '====> Script Start ============================>'

bash "${GITHUB_WORKSPACE}/.github/scripts/az-login.sh"

EP_LENGTH=$(az network private-endpoint-connection list --id $resource_id --query "[?properties.privateLinkServiceConnectionState.status == 'Pending'].id" -o json | jq 'length');

if [ "$dry_run" = "true" ]; then
    echo "Dry run only, skipping approval."
else
    echo "dry_run is empty or false, proceeding with approval."
    if [ "$EP_LENGTH" -eq 0 ]; then
        echo "No private endpoint connection found for $resource_id, skipping approval."
    else
    for endpoint_id in $(az network private-endpoint-connection list --id $resource_id --query "[?properties.privateLinkServiceConnectionState.status == 'Pending'].id" -o json | jq -rc '.[]'); do
        if [ -n "$endpoint_id" ]; then
        az network private-endpoint-connection approve --id $endpoint_id --description "Approved by Terraform"
        fi
    done
    fi
fi

echo '====> Script Finished =========================>'
exit 0

import { InputType, ghEnvironmentType } from "./types.js";
export declare function createValue(input: InputType, ghEnvironment: ghEnvironmentType): InputType;
export declare function createKeyValue(input: InputType, ghEnvironment: ghEnvironmentType): {
    key: string;
    value: InputType;
};
export declare function lowercaseKeys<T>(object: {
    [key: string]: T;
}): {
    [key: string]: T;
};

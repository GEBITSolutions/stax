packer {
  required_plugins {
    hcloud = {
      source  = "github.com/hetznercloud/hcloud"
      version = ">= 1.6.0"
    }
  }
}

variable "location" {
  type = string
}

variable "server_type" {
  type = string
}

variable "snapshot_name" {
  type = string
}

variable "snapshot_labels" {
  type = map(string)
}

variable "stax_build_target" {
  type    = string
  default = "hetzner"
}

variable "stax_stack_id" {
  type = string
}

variable "stax_env" {
  type = string
}

variable "stax_git_sha" {
  type = string
}

variable "stax_image_version" {
  type = string
}

variable "stax_scan_enabled" {
  type    = bool
  default = false
}

source "hcloud" "scanned" {
  location        = var.location
  server_type     = var.server_type
  image           = "ubuntu-24.04"
  ssh_username    = "root"
  snapshot_name   = var.snapshot_name
  snapshot_labels = var.snapshot_labels
}

build {
  sources = ["source.hcloud.scanned"]

  provisioner "shell" {
    inline = ["echo scanned golden image"]
  }

  # STAX materializes this script before validate/build when scan is configured.
  # A non-zero exit aborts packer build before the Hetzner snapshot is created.
  provisioner "shell" {
    script           = "${path.root}/.stax/scan/run.sh"
    environment_vars = ["STAX_SCAN_ENABLED=${var.stax_scan_enabled}"]
    execute_command  = "chmod +x '{{ .Path }}'; {{ if .Vars }}{{ .Vars }} {{ end }}sudo -E '{{ .Path }}'"
  }

  post-processor "manifest" {
    output     = "manifest.json"
    strip_path = true
  }
}

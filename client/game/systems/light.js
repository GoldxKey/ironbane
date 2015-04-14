angular
    .module('game.systems.light', [
        'ces',
        'three'
    ])
    .factory('LightSystem', [
        'System',
        'THREE',
        function(System, THREE) {
            'use strict';

            var LIGHTS = ['PointLight', 'DirectionalLight', 'SpotLight', 'AmbientLight', 'HemisphereLight'];

            var LightSystem = System.extend({
                addedToWorld: function(world) {
                    var sys = this;

                    sys._super(world);

                    world.entityAdded('light').add(function(entity) {
                        var lightData = entity.getComponent('light'),
                            light;

                        if (LIGHTS.indexOf(lightData.type) === -1) {
                            throw new TypeError('Invalid light type!');
                        }

                        // Hack for Clara's inability to export Hemisphere or
                        // ambient lights (TODO make a bug report)
                        // When the name is an "AmbientLight" we simply change the
                        // light component to be an AmbientLight as well
                        if (entity.name === 'AmbientLight') {
                            lightData.type = 'AmbientLight';
                        }

                        switch (lightData.type) {
                            case 'DirectionalLight':
                                light = new THREE.DirectionalLight(lightData.color, lightData.intensity);
                                break;
                            case 'PointLight':
                                light = new THREE.PointLight(lightData.color, lightData.intensity, lightData.distance);
                                break;
                            case 'SpotLight':
                                light = new THREE.SpotLight(lightData.color, lightData.intensity, lightData.distance, lightData.angle, lightData.exponent);
                                break;
                            case 'AmbientLight':
                                light = new THREE.AmbientLight(lightData.color);
                                break;
                            case 'HemisphereLight':
                                light = new THREE.HemisphereLight(lightData.skyColor, lightData.groundColor, lightData.intensity);
                                break;
                        }

                        lightData._light = light;
                        entity.add(light);
                    });
                },
                update: function() {
                    // nothing
                }
            });

            return LightSystem;
        }
    ]);
